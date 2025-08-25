"use client";
import React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Mail, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useState } from "react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

// Form schema for email submission
const emailSchema = z.object({
  email: z.string().email({
    message: "Unesite ispravnu email adresu.",
  }),
});

// Form schema for code verification and new password
const resetSchema = z
  .object({
    code: z.string().length(6, {
      message: "Kod mora imati 6 karaktera.",
    }),
    newPassword: z.string().min(6, {
      message: "Nova lozinka mora imati najmanje 6 karaktera.",
    }),
    confirmPassword: z.string().min(6, {
      message: "Potvrdite lozinku mora imati najmanje 6 karaktera.",
    }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Lozinke se ne podudaraju.",
    path: ["confirmPassword"],
  });

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  // State to track the current step of the password reset flow
  const [step, setStep] = useState<"email" | "verify">("email");
  const [email, setEmail] = useState("");

  // Form for email submission
  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      email: "",
    },
  });

  // Form for verification code and new password
  const resetForm = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: {
      code: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Handle email submission
  function onEmailSubmit(values: z.infer<typeof emailSchema>) {
    console.log("Email for reset:", values.email);

    // In a real app, this would call an API to send a reset code
    // For demo purposes, we'll simulate a successful email sending

    setEmail(values.email);
    toast({
      title: "Kod za resetovanje je poslat",
      description: "Proverite vašu email adresu za kod za resetovanje lozinke.",
    });

    setStep("verify");
  }

  // Handle verification and password reset
  function onResetSubmit(values: z.infer<typeof resetSchema>) {
    console.log("Reset data:", values);
    console.log("Email:", email);

    // In a real app, this would call an API to verify the code and update password
    // For demo purposes, we'll simulate a successful password reset

    toast({
      title: "Lozinka uspešno resetovana",
      description: "Možete se prijaviti sa vašom novom lozinkom.",
    });

    // Redirect to login page after 2 seconds
    setTimeout(() => {
      window.location.href = "/prijava";
    }, 2000);
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 py-12 dark:bg-gray-900 transition-colors duration-200">
        <div className="container mx-auto px-4">
          <div className="max-w-md mx-auto bg-white rounded-lg shadow-md overflow-hidden dark:bg-gray-800 transition-colors duration-200">
            <div className="p-8">
              <h2 className="text-2xl font-bold text-center mb-6 text-health-primary dark:text-health-accent">
                {step === "email"
                  ? "Resetovanje lozinke"
                  : "Verifikacija i nova lozinka"}
              </h2>

              {step === "email" ? (
                <Form {...emailForm}>
                  <form
                    onSubmit={emailForm.handleSubmit(onEmailSubmit)}
                    className="space-y-6"
                  >
                    <FormField
                      control={emailForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email adresa</FormLabel>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                              <Mail size={18} />
                            </div>
                            <FormControl>
                              <Input
                                placeholder="vasa.adresa@email.com"
                                className="pl-10"
                                {...field}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full bg-health-primary hover:bg-health-secondary transition-colors duration-200 dark:bg-health-secondary dark:hover:bg-health-primary"
                    >
                      Pošalji kod za resetovanje
                    </Button>

                    <div className="text-center">
                      <a
                        href="/prijava"
                        className="text-sm text-health-primary hover:underline dark:text-health-accent"
                      >
                        Nazad na prijavu
                      </a>
                    </div>
                  </form>
                </Form>
              ) : (
                <Form {...resetForm}>
                  <form
                    onSubmit={resetForm.handleSubmit(onResetSubmit)}
                    className="space-y-6"
                  >
                    <div className="text-center mb-4">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Poslali smo kod za resetovanje na{" "}
                        <strong>{email}</strong>
                      </p>
                    </div>

                    <FormField
                      control={resetForm.control}
                      name="code"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>Verifikacioni kod</FormLabel>
                          <FormControl>
                            <InputOTP maxLength={6} {...field}>
                              <InputOTPGroup>
                                <InputOTPSlot index={0} />
                                <InputOTPSlot index={1} />
                                <InputOTPSlot index={2} />
                                <InputOTPSlot index={3} />
                                <InputOTPSlot index={4} />
                                <InputOTPSlot index={5} />
                              </InputOTPGroup>
                            </InputOTP>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={resetForm.control}
                      name="newPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nova lozinka</FormLabel>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                              <KeyRound size={18} />
                            </div>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="******"
                                className="pl-10"
                                {...field}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={resetForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Potvrdite novu lozinku</FormLabel>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                              <KeyRound size={18} />
                            </div>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="******"
                                className="pl-10"
                                {...field}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStep("email")}
                        className="border-health-primary text-health-primary dark:border-health-accent dark:text-health-accent"
                      >
                        Nazad
                      </Button>

                      <Button
                        type="submit"
                        className="bg-health-primary hover:bg-health-secondary transition-colors duration-200 dark:bg-health-secondary dark:hover:bg-health-primary"
                      >
                        Resetujte lozinku
                      </Button>
                    </div>
                  </form>
                </Form>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
