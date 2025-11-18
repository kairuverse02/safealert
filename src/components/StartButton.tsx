"use client";
import React, { useEffect } from "react";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LoginButton = () => {
  const router = useRouter();
  const supabase = createClient();
  
  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        router.push("/role");
      }
    };
    fetchUser();
  }, [router, supabase.auth]);

  return (
    <Button className="w-60 h-14 text-2xl font-medium bg-[#E7473C] cursor-pointer"
      onClick={() => {
        router.push("/login");
      }}
    >
      Start
    </Button>
  );
};

export default LoginButton;