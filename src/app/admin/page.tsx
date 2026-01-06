"use client";

import GuardianPairing from "./components/GuardianPairing";
import React, { useState } from "react";


export default function Home() {

  return (
    <>
      <div>
        <div className="mx-auto max-w-[1200px] mt-6">
          <GuardianPairing />
        </div>
      </div>
    </>
  );
}
