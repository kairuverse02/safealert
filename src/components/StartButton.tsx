"use client";
import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Spinner } from "@/components/ui/spinner";

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