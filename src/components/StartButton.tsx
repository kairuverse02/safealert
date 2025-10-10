"use client";
import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const LoginButton = () => {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();
  const supabase = createClient();
  
  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        router.push("/role");
      }
    };
    fetchUser();
  }, [router]);

  return (
    <Button className="w-70 h-20 text-4xl font-semibold bg-red-700"
      onClick={() => {
        router.push("/login");
      }}
    >
      START
    </Button>
  );
};

export default LoginButton;