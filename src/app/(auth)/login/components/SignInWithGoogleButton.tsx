"use client";
import { Button } from "@/components/ui/button";
import { signInWithGoogle } from "@/lib/auth-actions";
import React, { useState } from "react";
import Image from "next/image";
import { Spinner } from "@/components/ui/spinner";

const SignInWithGoogleButton = () => {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      await signInWithGoogle();
    } catch (error) {
      console.error('Google sign-in failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full hover:bg-neutral-200 cursor-pointer"
      onClick={handleGoogleSignIn}
      disabled={isLoading}>
      
      {isLoading ? (
      <Spinner className="mr-2 h-4 w-4" />
      ) : (
        <Image src="/assets/googleicon.png" alt="google-icon-logo" width={20} height={20} className="mr-2" />
      )}
      
      {isLoading ? 'Signing in...' : 'Sign in with Google'}

    </Button>
  );
};

export default SignInWithGoogleButton;

