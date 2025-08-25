import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "apostekafm@gmail.com";

async function parseBody(request: Request): Promise<{ name?: string; email?: string; message?: string }> {
    // Try JSON first (regardless of header)
    try {
        const json = await request.clone().json();
        if (json && typeof json === "object") return json;
    } catch { }
    // Try form data
    try {
        const form = await request.clone().formData();
        return {
            name: String(form.get("name") || ""),
            email: String(form.get("email") || ""),
            message: String(form.get("message") || ""),
        };
    } catch { }
    // Try raw text JSON
    try {
        const raw = await request.text();
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed;
        }
    } catch { }
    return {};
}

export async function POST(request: Request) {
    try {
        const body = await parseBody(request);
        const name = (body.name || "").toString().trim();
        const email = (body.email || "").toString().trim();
        const message = (body.message || "").toString().trim();

        if (!name || !email || !message) {
            return NextResponse.json({ error: "Missing fields" }, { status: 400 });
        }

        const host = process.env.SMTP_HOST;
        const portRaw = process.env.SMTP_PORT;
        const port = portRaw ? parseInt(portRaw, 10) : undefined;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;

        // If SMTP is not configured, respond OK in mock mode (dev-friendly)
        if (!host || !port || !user || !pass) {
            return NextResponse.json({
                ok: true,
                mocked: true,
                missing: {
                    SMTP_HOST: !host,
                    SMTP_PORT: !portRaw,
                    SMTP_USER: !user,
                    SMTP_PASS: !pass,
                },
            });
        }

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
        });

        await transporter.sendMail({
            from: `Pharmagician <no-reply@pharmagician.rs>`,
            to: CONTACT_EMAIL,
            replyTo: email,
            subject: `Kontakt forma: ${name}`,
            text: `Ime: ${name}\nEmail: ${email}\n\nPoruka:\n${message}`,
            html: `<p><strong>Ime:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Poruka:</strong></p><p>${escapeHtml(
                message,
            )}</p>`,
        });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        const message = err?.message || "Invalid payload";
        return NextResponse.json({ error: message }, { status: 400 });
    }
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
