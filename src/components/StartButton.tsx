"use client";
import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const StartButton = () => {
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
      className="w-60 h-14 text-2xl font-bold bg-gradient-to-r from-[#E7473C] to-[#D63A31] hover:shadow-md hover:shadow-[#E7473C]/50 cursor-pointer flex items-center justify-center gap-2 rounded-full active:scale-95 disabled:opacity-70"
      onClick={handleClick}
      disabled={isLoading}
    >
      {isLoading ? (
        <div className="flex items-center">
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

export default StartButton;