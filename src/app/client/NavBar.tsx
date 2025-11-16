'use client'
import { useState, useRef, useEffect } from 'react';
import { User, Settings, LogOut,  FileText } from 'lucide-react';
import IconLogo from '@/../public/assets/iconlogo.png';
import TextLogo from '@/../public/assets/textlogo.svg';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
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
  const supabase = createClient();
  
  // State to track if dropdown is open or closed
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  
  // Reference to the dropdown element for click outside detection
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
            <Link href="/client"
              className="flex gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">
              {/* 💡 IconLogo */}
              <img 
                src={(IconLogo as any).src || IconLogo} // Handle object/string import
                alt="Logo Icon" 
                className="h-10 w-auto cursor-pointer"
              />
              {/* 💡 TextLogo */}
              <img 
                src={(TextLogo as any).src || TextLogo} // Handle object/string import
                alt="Brand Name" 
                className="h-8 w-auto cursor-pointer hidden sm:block" // Hide text on small screens if desired
              />
            </Link>
          </div>

          {/* RIGHT COLUMN: Profile Icon with Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={toggleDropdown}
              className="flex items-center focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
            >
              <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold hover:bg-blue-600 transition-colors">
                {user.avatarUrl ? (
                  <img 
                    src={user.avatarUrl} 
                    alt="Profile" 
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
                <Link href="/client/account"
                  className="w-full flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <Settings size={18} className="mr-3 text-gray-500" />
                  <span>Account Settings</span>
                </Link>
                <Link href="/client/settings"
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
          </div>
        </div>
      </div>
    </nav>
  );
}