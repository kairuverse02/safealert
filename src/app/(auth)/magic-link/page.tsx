'use client'
import Link from "next/link"

import React, { useState, useTransition } from "react";
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner";
import { sendMagicLink } from "@/lib/auth-actions"


const MagicLink = () => {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [linkSent, setLinkSent] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const validateEmail = (emailValue: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailValue);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailError(null);

    if (!email.trim()) {
      setEmailError("Email is required");
      return;
    }

    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    startTransition(async () => {
      try {
        const result = await sendMagicLink(email);
        
        if (result.error) {
          setEmailError(result.error);
        } else if (result.success) {
          setLinkSent(true);
          setToastMessage("Sent successfully! Check your email for a magic link.");
        }
      } catch (err) {
        setEmailError((err as Error).message || "Failed to send magic link");
      }
    });
  };

  const handleBackToLogin = () => {
    setEmail("");
    setEmailError(null);
    setLinkSent(false);
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center p-4 overflow-hidden fixed inset-0 bg-[#F0F0F0]">
      <Card className="mx-auto max-w-sm w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-[#E7473C]">Magic Link</CardTitle>
          <CardDescription>
            {linkSent 
              ? "Check your email for a magic link" 
              : "Enter your email below to receive a magic link for login."
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!linkSent ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="johndoe@email.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError(null);
                  }}
                  required
                  disabled={isPending}
                />
                {emailError && (
                  <p className="text-red-500 text-sm">{emailError}</p>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="flex-1 bg-[#E7473C] hover:bg-[#D9271B] font-semibold text-base tracking-wide cursor-pointer"
                  disabled={isPending}
                >
                  {isPending && <Spinner className="mr-2 h-4 w-4 animate-spin" />}
                  {isPending ? "Sending..." : "Send Link"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="font-semibold text-base tracking-wide"
                  onClick={handleBackToLogin}
                  disabled={isPending}
                >
                  <Link href="/login">Back to Login</Link>
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-gray-700">
                  We&apos;ve sent a magic link to <strong className="text-[#E7473C]">{email}</strong>
                </p>
              </div>
              <p className="text-sm text-gray-600">
                Click the link in your email to continue logging in. The link will expire in 24 hours.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full font-semibold text-base tracking-wide"
                onClick={handleBackToLogin}
              >
                <Link href="/login">Back to Login</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default MagicLink;
