'use client'
import Link from "next/link"

import React, {useState, useTransition } from "react";
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
import { Eye, EyeClosed } from 'lucide-react';

import { login } from "@/lib/auth-actions"
import SignInWithGoogleButton from "./SignInWithGoogleButton"


export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await login(formData);
      } catch (err) {
        setError((err as Error).message || 'Login failed');
      }
    });
  };


  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-[#E7473C]">Login</CardTitle>
        <CardDescription>
          Enter your email below to login to your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit}>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder=""
                  required
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                  <Link href="#" className="ml-auto inline-block text-sm underline">
                    Forgot your password?
                  </Link>
                </div>
                <div className="relative">
                  <Input 
                    id="password" 
                    name="password" 
                    type={showPassword ? "text" : "password"} 
                    required 
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeClosed size={20} />
                    ) : (
                      <Eye size={20} />
                    )}
                  </button>
                </div>
              </div>

              {error && <div className="text-red-500 text-sm">{error}</div>}

              <Button type="submit" 
              className="w-full bg-[#E7473C] hover:bg-[#D9271B] cursor-pointer"
              disabled={isPending}>
              {isPending && ( <Spinner className="mr-2 h-4 w-4 animate-spin" />)}
              {isPending ? 'Logging in...' : 'login'}
              </Button>


            <SignInWithGoogleButton/> 
            </div>
        </form>
        {/* Signup link */}
        <div className="mt-4 text-center text-sm">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="underline text-[#E7473C]">
            Sign up
          </Link> 
        </div>
      </CardContent>
    </Card>
  )
}