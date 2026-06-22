package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/smtp"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const sessionTTL = 30 * 24 * time.Hour
const authTokenTTL = 30 * time.Minute

type authUser struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	EmailVerified bool   `json:"emailVerified"`
}

// ---- helpers ----

func appURL() string {
	if u := strings.TrimRight(os.Getenv("APP_URL"), "/"); u != "" {
		return u
	}
	return "https://aposteka.rs"
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v interface{}) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func normEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validEmail(email string) bool {
	at := strings.IndexByte(email, '@')
	return at > 0 && at < len(email)-1 && !strings.ContainsAny(email, " \t\n")
}

// sendMail sends an email via SMTP; if SMTP isn't configured it logs the message
// (so magic-link/reset flows work in development by surfacing the link in logs).
func sendMail(to, subject, body string) error {
	host, port := os.Getenv("SMTP_HOST"), os.Getenv("SMTP_PORT")
	user, pass := os.Getenv("SMTP_USER"), os.Getenv("SMTP_PASS")
	if host == "" || port == "" || user == "" || pass == "" {
		log.Printf("[email mock] to=%s subject=%q\n%s", to, subject, body)
		return nil
	}
	from := "Apoteka <" + user + ">"
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s",
		from, to, subject, body)
	auth := smtp.PlainAuth("", user, pass, host)
	return smtp.SendMail(host+":"+port, auth, user, []string{to}, []byte(msg))
}

// ---- sessions ----

func (s *server) createSession(userID, userAgent string) (string, error) {
	token := randomToken()
	_, err := s.db.Exec(
		`INSERT INTO "Session" ("tokenHash","userId","userAgent","expiresAt") VALUES ($1,$2,$3,$4)`,
		hashToken(token), userID, userAgent, time.Now().Add(sessionTTL))
	if err != nil {
		return "", err
	}
	return token, nil
}

// currentUser resolves the bearer token to a user, or nil if unauthenticated.
func (s *server) currentUser(r *http.Request) *authUser {
	if s.db == nil {
		return nil
	}
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return nil
	}
	token := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	if token == "" {
		return nil
	}
	var u authUser
	err := s.db.QueryRow(`
		SELECT u.id, u.email, COALESCE(u.name,''), u."emailVerified"
		FROM "Session" s JOIN "User" u ON u.id = s."userId"
		WHERE s."tokenHash" = $1 AND s."expiresAt" > now()`,
		hashToken(token)).Scan(&u.ID, &u.Email, &u.Name, &u.EmailVerified)
	if err != nil {
		return nil
	}
	return &u
}

func (s *server) userByEmail(email string) (*authUser, string, error) {
	var u authUser
	var hash sql.NullString
	err := s.db.QueryRow(`SELECT id, email, COALESCE(name,''), "emailVerified", "passwordHash" FROM "User" WHERE lower(email)=lower($1)`, email).
		Scan(&u.ID, &u.Email, &u.Name, &u.EmailVerified, &hash)
	if err != nil {
		return nil, "", err
	}
	return &u, hash.String, nil
}

// findOrCreateUser returns an existing user by email or creates a passwordless one.
func (s *server) findOrCreateUser(email, name string, verified bool) (*authUser, error) {
	u, _, err := s.userByEmail(email)
	if err == nil {
		return u, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	id := ""
	err = s.db.QueryRow(
		`INSERT INTO "User" (email, name, "emailVerified") VALUES ($1,$2,$3) RETURNING id`,
		normEmail(email), strings.TrimSpace(name), verified).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &authUser{ID: id, Email: normEmail(email), Name: strings.TrimSpace(name), EmailVerified: verified}, nil
}

func (s *server) respondWithSession(w http.ResponseWriter, r *http.Request, u *authUser) {
	token, err := s.createSession(u.ID, r.UserAgent())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create session")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"token": token, "user": u})
}

// ---- handlers ----

func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Name, Password string }
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	in.Email = normEmail(in.Email)
	if !validEmail(in.Email) {
		writeErr(w, http.StatusBadRequest, "Unesite ispravnu email adresu")
		return
	}
	if len(in.Password) < 6 {
		writeErr(w, http.StatusBadRequest, "Lozinka mora imati najmanje 6 karaktera")
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	var id string
	err := s.db.QueryRow(
		`INSERT INTO "User" (email, name, "passwordHash") VALUES ($1,$2,$3) RETURNING id`,
		in.Email, strings.TrimSpace(in.Name), string(hash)).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "idx_user_email") || strings.Contains(err.Error(), "duplicate") {
			writeErr(w, http.StatusConflict, "Nalog sa ovom email adresom već postoji")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create account")
		return
	}
	s.respondWithSession(w, r, &authUser{ID: id, Email: in.Email, Name: strings.TrimSpace(in.Name)})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	u, hash, err := s.userByEmail(normEmail(in.Email))
	if err != nil || hash == "" {
		writeErr(w, http.StatusUnauthorized, "Pogrešan email ili lozinka")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "Pogrešan email ili lozinka")
		return
	}
	s.respondWithSession(w, r, u)
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		token := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		_, _ = s.db.Exec(`DELETE FROM "Session" WHERE "tokenHash"=$1`, hashToken(token))
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": u})
}

func (s *server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var in struct{ Name, Email string }
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	email := normEmail(in.Email)
	if !validEmail(email) {
		writeErr(w, http.StatusBadRequest, "Unesite ispravnu email adresu")
		return
	}
	_, err := s.db.Exec(`UPDATE "User" SET name=$1, email=$2, "updatedAt"=now() WHERE id=$3`,
		strings.TrimSpace(in.Name), email, u.ID)
	if err != nil {
		if strings.Contains(err.Error(), "idx_user_email") || strings.Contains(err.Error(), "duplicate") {
			writeErr(w, http.StatusConflict, "Email adresa je već u upotrebi")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not update profile")
		return
	}
	u.Name, u.Email = strings.TrimSpace(in.Name), email
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": u})
}

func (s *server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var in struct{ CurrentPassword, NewPassword string }
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	if len(in.NewPassword) < 6 {
		writeErr(w, http.StatusBadRequest, "Lozinka mora imati najmanje 6 karaktera")
		return
	}
	var hash sql.NullString
	_ = s.db.QueryRow(`SELECT "passwordHash" FROM "User" WHERE id=$1`, u.ID).Scan(&hash)
	if hash.Valid && hash.String != "" {
		if bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(in.CurrentPassword)) != nil {
			writeErr(w, http.StatusUnauthorized, "Trenutna lozinka nije ispravna")
			return
		}
	}
	nh, _ := bcrypt.GenerateFromPassword([]byte(in.NewPassword), bcrypt.DefaultCost)
	_, _ = s.db.Exec(`UPDATE "User" SET "passwordHash"=$1, "updatedAt"=now() WHERE id=$2`, string(nh), u.ID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// issueOneTimeToken creates an AuthToken and returns the clear token.
func (s *server) issueOneTimeToken(email, purpose, userID string) (string, error) {
	token := randomToken()
	var uid interface{}
	if userID != "" {
		uid = userID
	}
	_, err := s.db.Exec(
		`INSERT INTO "AuthToken" ("tokenHash", email, purpose, "userId", "expiresAt") VALUES ($1,$2,$3,$4,$5)`,
		hashToken(token), normEmail(email), purpose, uid, time.Now().Add(authTokenTTL))
	return token, err
}

func (s *server) handleMagicLink(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email string }
	if err := readJSON(r, &in); err != nil || !validEmail(normEmail(in.Email)) {
		writeErr(w, http.StatusBadRequest, "Unesite ispravnu email adresu")
		return
	}
	email := normEmail(in.Email)
	token, err := s.issueOneTimeToken(email, "magic_login", "")
	if err == nil {
		link := appURL() + "/prijava?token=" + url.QueryEscape(token)
		_ = sendMail(email, "Prijava na Apoteka",
			fmt.Sprintf(`<p>Kliknite da se prijavite:</p><p><a href="%s">Prijavi me</a></p><p>Link važi 30 minuta.</p>`, link))
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) // don't leak existence
}

func (s *server) consumeOneTimeToken(token, purpose string) (email, userID string, ok bool) {
	var em string
	var uid sql.NullString
	err := s.db.QueryRow(
		`UPDATE "AuthToken" SET "usedAt"=now()
		 WHERE "tokenHash"=$1 AND purpose=$2 AND "usedAt" IS NULL AND "expiresAt" > now()
		 RETURNING email, "userId"`,
		hashToken(token), purpose).Scan(&em, &uid)
	if err != nil {
		return "", "", false
	}
	return em, uid.String, true
}

func (s *server) handleMagicConsume(w http.ResponseWriter, r *http.Request) {
	var in struct{ Token string }
	if err := readJSON(r, &in); err != nil || in.Token == "" {
		writeErr(w, http.StatusBadRequest, "invalid token")
		return
	}
	email, _, ok := s.consumeOneTimeToken(in.Token, "magic_login")
	if !ok {
		writeErr(w, http.StatusUnauthorized, "Link je istekao ili je već iskorišćen")
		return
	}
	u, err := s.findOrCreateUser(email, "", true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	s.respondWithSession(w, r, u)
}

func (s *server) handlePasswordResetRequest(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email string }
	if err := readJSON(r, &in); err != nil || !validEmail(normEmail(in.Email)) {
		writeErr(w, http.StatusBadRequest, "Unesite ispravnu email adresu")
		return
	}
	email := normEmail(in.Email)
	if u, _, err := s.userByEmail(email); err == nil {
		if token, err := s.issueOneTimeToken(email, "password_reset", u.ID); err == nil {
			link := appURL() + "/reset-lozinke?token=" + url.QueryEscape(token)
			_ = sendMail(email, "Resetovanje lozinke",
				fmt.Sprintf(`<p>Kliknite da postavite novu lozinku:</p><p><a href="%s">Resetuj lozinku</a></p><p>Link važi 30 minuta.</p>`, link))
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) handlePasswordResetConfirm(w http.ResponseWriter, r *http.Request) {
	var in struct{ Token, NewPassword string }
	if err := readJSON(r, &in); err != nil || in.Token == "" {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	if len(in.NewPassword) < 6 {
		writeErr(w, http.StatusBadRequest, "Lozinka mora imati najmanje 6 karaktera")
		return
	}
	_, userID, ok := s.consumeOneTimeToken(in.Token, "password_reset")
	if !ok || userID == "" {
		writeErr(w, http.StatusUnauthorized, "Link je istekao ili je već iskorišćen")
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(in.NewPassword), bcrypt.DefaultCost)
	_, _ = s.db.Exec(`UPDATE "User" SET "passwordHash"=$1, "emailVerified"=true, "updatedAt"=now() WHERE id=$2`, string(hash), userID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleGoogle verifies a Google Identity Services ID token and signs the user in.
func (s *server) handleGoogle(w http.ResponseWriter, r *http.Request) {
	var in struct{ Credential string }
	if err := readJSON(r, &in); err != nil || in.Credential == "" {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	claims, err := verifyGoogleIDToken(in.Credential)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "Google prijava nije uspela")
		return
	}
	email := normEmail(claims.Email)
	// Link by googleSub or email; create if new.
	var u authUser
	err = s.db.QueryRow(`SELECT id, email, COALESCE(name,''), "emailVerified" FROM "User" WHERE "googleSub"=$1 OR lower(email)=lower($2)`,
		claims.Sub, email).Scan(&u.ID, &u.Email, &u.Name, &u.EmailVerified)
	if err == sql.ErrNoRows {
		err = s.db.QueryRow(
			`INSERT INTO "User" (email, name, "googleSub", "emailVerified") VALUES ($1,$2,$3,true) RETURNING id, email, COALESCE(name,''), "emailVerified"`,
			email, claims.Name, claims.Sub).Scan(&u.ID, &u.Email, &u.Name, &u.EmailVerified)
	} else if err == nil {
		_, _ = s.db.Exec(`UPDATE "User" SET "googleSub"=$1, "emailVerified"=true WHERE id=$2`, claims.Sub, u.ID)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	s.respondWithSession(w, r, &u)
}

type googleClaims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Aud   string `json:"aud"`
}

// verifyGoogleIDToken validates the ID token via Google's tokeninfo endpoint and
// checks the audience matches our configured client id.
func verifyGoogleIDToken(credential string) (*googleClaims, error) {
	resp, err := http.Get("https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(credential))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google verification failed: %d", resp.StatusCode)
	}
	var c googleClaims
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		return nil, err
	}
	if c.Email == "" {
		return nil, fmt.Errorf("no email in token")
	}
	if clientID := os.Getenv("GOOGLE_CLIENT_ID"); clientID != "" && c.Aud != clientID {
		return nil, fmt.Errorf("audience mismatch")
	}
	return &c, nil
}

func (s *server) registerAuthRoutes(mux *http.ServeMux) {
	guard := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if s.db == nil {
				writeErr(w, http.StatusServiceUnavailable, "database not connected")
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("/api/auth/register", guard(s.handleRegister))
	mux.HandleFunc("/api/auth/login", guard(s.handleLogin))
	mux.HandleFunc("/api/auth/logout", guard(s.handleLogout))
	mux.HandleFunc("/api/auth/me", guard(s.handleMe))
	mux.HandleFunc("/api/auth/profile", guard(s.handleUpdateProfile))
	mux.HandleFunc("/api/auth/password", guard(s.handleChangePassword))
	mux.HandleFunc("/api/auth/magic-link", guard(s.handleMagicLink))
	mux.HandleFunc("/api/auth/magic-consume", guard(s.handleMagicConsume))
	mux.HandleFunc("/api/auth/password-reset", guard(s.handlePasswordResetRequest))
	mux.HandleFunc("/api/auth/password-reset/confirm", guard(s.handlePasswordResetConfirm))
	mux.HandleFunc("/api/auth/google", guard(s.handleGoogle))
}
