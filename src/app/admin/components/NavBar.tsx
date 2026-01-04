'use client'
import { useState, useRef, useEffect } from 'react'; // ✨ FIX: Imported useEffect
import { User, Settings, LogOut,  FileText } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signout } from '@/lib/auth-actions';
import { Spinner } from '@/components/ui/spinner';

interface NavbarProps {
  user?: {
    fName: string;
    username: string;
    avatarUrl?: string;
  };
}

export default function Navbar({ 
  user = { fName: 'John Doe', username: 'johndoe' },
}: NavbarProps) {
  const router = useRouter();
  // const supabase = createClient();
  
  // Track if dropdown is open or closed
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  
  // Track if component is mounted
  const [isMounted, setIsMounted] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true);
      await signout();
      router.push('/');
    } finally {
      setIsSigningOut(false);
      setIsDropdownOpen(false);
    }
  };

  // Toggle dropdown open/closed
  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  // Set mounted to true only on the client, after hydration
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    // Add event listener when dropdown is open
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    // Cleanup event listener
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);


  return (
    <nav className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
        <div className="flex justify-between items-center h-20">
          
          {/* LEFT COLUMN: Logo */}
          <div>
            <Link href="/admin"
              className="flex gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">
              {/* 💡 IconLogo */}
              <Image
                src="/assets/iconlogo.png"
                alt="Logo Icon"
                width={40}
                height={40}
                className="h-10 w-auto cursor-pointer"
              />
              {/* 💡 TextLogo */}
              <Image
                src="/assets/textlogo.svg"
                alt="Brand Name"
                width={120}
                height={32}
                className="h-8 w-auto cursor-pointer hidden sm:block"
              />
            </Link>
          </div>

          {/* RIGHT COLUMN: Profile Icon with Dropdown */}
          <div className="relative" ref={dropdownRef}>
            {/* ✨ FIX: Wait for mount before rendering user-dependent UI */}
            {!isMounted ? (
              // Render a placeholder to match server render
              <div className="h-10 w-10 rounded-full bg-gray-200" />
            ) : (
              // Once mounted, render the actual UI
              <>
                <button
                  onClick={toggleDropdown}
                  className="flex items-center focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                >
                  <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold hover:bg-blue-600 transition-colors">
                    {user.avatarUrl ? (
                      <Image
                        src={user.avatarUrl}
                        alt="Profile"
                        width={40}
                        height={40}
                        unoptimized
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <User size={26} />
                    )} 
                  </div>
                </button>

                {/* DROPDOWN MENU */}
                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg py-2 z-50 border border-gray-200">
                    
                    {/* FIRST ITEM: User Info */}
                    <div className="px-4 py-3 border-b border-gray-200">
                      <div className="flex items-start space-x-3">
                        <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                          <User size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            Hello, {user.fName}!
                          </p>
                          <p className="text-sm text-gray-500 truncate">
                            @{user.username}
                          </p>
                        </div>
                      </div>
                    </div>
                    {/* MENU ITEMS */}
                    <Link href="/admin/profile"
                      className="w-full flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Settings size={18} className="mr-3 text-gray-500" />
                      <span>Account Settings</span>
                    </Link>
                    <Link href="/admin/settings"
                      className="w-full flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <FileText size={18} className="mr-3 text-gray-500" />
                      <span>Privacy Policy</span>
                    </Link>
                    <button
                      onClick={handleSignOut}
                      disabled={isSigningOut}
                      className="w-full flex items-center px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {isSigningOut ? (
                        <Spinner className="mr-3 h-4 w-4" />
                      ) : (
                        <LogOut size={18} className="mr-3" />
                      )}
                      <span>{isSigningOut ? 'Signing out...' : 'Sign out'}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}