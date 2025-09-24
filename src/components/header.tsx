import React from "react";
import Link from "next/link";

export default function Header() {
  return (
    <div>
      <nav>
        <Link href="/admin-side">About</Link>
      </nav>
    </div>
  );
}
