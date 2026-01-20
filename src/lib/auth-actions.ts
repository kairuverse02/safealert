"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const supabase = await createClient();

  // type-casting here for convenience
  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    const errorMsg = error.message || 'Login failed';
    redirect(`/error?message=${encodeURIComponent('Login failed')}&reason=${encodeURIComponent(errorMsg)}`);
  }
  revalidatePath("/role", "layout");
  redirect("/role");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

  // validate the inputs
  const firstName = formData.get("first-name") as string;
  const lastName = formData.get("last-name") as string;
  
  // Build the redirect URL for email confirmation. Normalize the configured
  // `NEXT_PUBLIC_SITE_URL` to its origin to avoid including any extra path
  // segments (which previously caused verification links like
  // `/role/auth/confirm` and resulted in 404s).
  const rawOrigin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  let origin: string;
  try {
    origin = new URL(rawOrigin).origin;
  } catch (e) {
    console.error(`Invalid NEXT_PUBLIC_SITE_URL: "${rawOrigin}"`, e);
    origin = "http://localhost:3000"; // fall back if value isn't a parseable URL
  }
  const redirectUrl = `${origin}/auth/confirm`;
  console.log('Using emailRedirectTo for signup:', redirectUrl);
  console.log('NEXT_PUBLIC_SITE_URL value:', process.env.NEXT_PUBLIC_SITE_URL);
  
  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    options: {
      emailRedirectTo: redirectUrl,
      data: {
        full_name: `${firstName + " " + lastName}`,
        email: formData.get("email") as string,
      },
    },
  };

  const { error } = await supabase.auth.signUp(data);

  if (error) {
    console.error('Signup error:', error);
    const errorMsg = error.message || 'Signup failed';
    redirect(`/error?message=${encodeURIComponent('Signup failed')}&reason=${encodeURIComponent(errorMsg)}`);
  }
  
  // Show a message that verification email was sent
  redirect("/auth/verify-email");
}

export async function signout() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.log(error);
    redirect("/error");
  }

  redirect("/logout");
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    console.log(error);
    redirect("/error");
  }

  redirect(data.url);
}

export async function logInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    console.log(error);
    redirect("/error");
  }

  redirect(data.url);
}

export async function sendMagicLink(email: string) {
  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/callback`,
      },
    });

    if (error) {
      return { error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { error: (err as Error).message || "Failed to send magic link" };
  }
}

