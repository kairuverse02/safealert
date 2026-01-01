"use client";
import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LoginButton = () => {
  const router = useRouter();
  const supabase = createClient();
  const [isLoading, setIsLoading] = useState(false);
  
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

  const handleClick = async () => {
    setIsLoading(true);
    await router.push("/login");
  };

  return (
    <Button 
      className="w-60 h-14 text-2xl font-medium bg-[#E7473C] cursor-pointer flex items-center justify-center gap-2"
      onClick={handleClick}
      disabled={isLoading}
    >
      {isLoading ? (
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "0s" }}></span>
          <span className="h-2 w-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></span>
          <span className="h-2 w-2 bg-white rounded-full animate-bounce" style={{ animationDelay: "0.4s" }}></span>
        </div>
      ) : (
        "Start"
      )}
    </Button>
  );
};

export default LoginButton;