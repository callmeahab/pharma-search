"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import WatchlistPanel from "@/components/WatchlistPanel";
import { Heart, User as UserIcon } from "lucide-react";

export const dynamic = "force-dynamic";

type Tab = "watchlist" | "settings";

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, logout, updateProfile, changePassword } = useAuth();
  const [tab, setTab] = useState<Tab>("watchlist");

  useEffect(() => {
    if (!loading && !user) router.push("/prijava");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex flex-col bg-health-light dark:bg-gray-900">
        <Navbar />
        <main className="flex-grow flex items-center justify-center">
          <p className="text-gray-600 dark:text-gray-400">Učitavanje...</p>
        </main>
        <Footer />
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <div className="min-h-screen flex flex-col bg-health-light dark:bg-gray-900">
      <Navbar />
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                  Dobrodošli, {user.name || user.email}!
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Pratite cene omiljenih proizvoda i upravljajte nalogom
                </p>
              </div>
              <Button
                onClick={handleLogout}
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Odjavite se
              </Button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700">
            <div className="flex border-b dark:border-gray-700">
              <TabButton active={tab === "watchlist"} onClick={() => setTab("watchlist")} icon={<Heart size={16} />}>
                Praćene cene
              </TabButton>
              <TabButton active={tab === "settings"} onClick={() => setTab("settings")} icon={<UserIcon size={16} />}>
                Podešavanja naloga
              </TabButton>
            </div>

            <div className="p-6">
              {tab === "watchlist" && <WatchlistPanel />}
              {tab === "settings" && (
                <AccountSettings
                  initialName={user.name}
                  initialEmail={user.email}
                  emailVerified={user.emailVerified}
                  onUpdateProfile={updateProfile}
                  onChangePassword={changePassword}
                />
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${
        active
          ? "text-health-primary border-b-2 border-health-primary dark:text-health-accent dark:border-health-accent"
          : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function AccountSettings({
  initialName,
  initialEmail,
  emailVerified,
  onUpdateProfile,
  onChangePassword,
}: {
  initialName: string;
  initialEmail: string;
  emailVerified: boolean;
  onUpdateProfile: (name: string, email: string) => Promise<void>;
  onChangePassword: (cur: string, nw: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [savingProfile, setSavingProfile] = useState(false);

  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [savingPass, setSavingPass] = useState(false);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await onUpdateProfile(name, email);
      toast({ title: "Sačuvano", description: "Podaci naloga su ažurirani." });
    } catch (err) {
      toast({ title: "Greška", description: err instanceof Error ? err.message : "Neuspešno čuvanje." });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.length < 8) {
      toast({ title: "Greška", description: "Nova lozinka mora imati najmanje 8 karaktera." });
      return;
    }
    setSavingPass(true);
    try {
      await onChangePassword(curPass, newPass);
      setCurPass("");
      setNewPass("");
      toast({ title: "Sačuvano", description: "Lozinka je promenjena." });
    } catch (err) {
      toast({ title: "Greška", description: err instanceof Error ? err.message : "Neuspešna promena lozinke." });
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <div className="space-y-8 max-w-lg">
      <form onSubmit={saveProfile} className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Podaci naloga</h3>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Ime i prezime</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ime i prezime" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Email adresa{" "}
            {emailVerified ? (
              <span className="text-xs text-green-600 dark:text-green-400">(potvrđen)</span>
            ) : (
              <span className="text-xs text-amber-600 dark:text-amber-400">(nije potvrđen)</span>
            )}
          </label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email adresa" />
        </div>
        <Button type="submit" disabled={savingProfile} className="bg-health-primary hover:bg-health-secondary text-white">
          {savingProfile ? "Čuvanje..." : "Sačuvaj izmene"}
        </Button>
      </form>

      <div className="border-t dark:border-gray-700 pt-8">
        <form onSubmit={savePassword} className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Promena lozinke</h3>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Trenutna lozinka</label>
            <Input type="password" autoComplete="current-password" value={curPass} onChange={(e) => setCurPass(e.target.value)} placeholder="Trenutna lozinka" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Nova lozinka</label>
            <Input type="password" autoComplete="new-password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Najmanje 8 karaktera" />
          </div>
          <Button type="submit" disabled={savingPass} variant="outline">
            {savingPass ? "Čuvanje..." : "Promeni lozinku"}
          </Button>
        </form>
      </div>
    </div>
  );
}
