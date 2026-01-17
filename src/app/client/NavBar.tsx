'use client'
import { useState, useRef, useEffect } from 'react';
import { User, Settings, LogOut,  FileText } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signout } from '@/lib/auth-actions';
import { Spinner } from '@/components/ui/spinner';
import { useWebRTC } from '@/contexts/WebRTCContext';

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
  
  // Get WebRTC context state - safely handle if not in WebRTC context
  let webrtcContext = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    webrtcContext = useWebRTC();
  } catch {
    // Not in WebRTC context (e.g., NavBar used outside of WebRTCProvider)
    webrtcContext = null;
  }
  
  // State to track if dropdown is open or closed
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // Pairing status (reads from localStorage.pairingRoomId)
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Close dropdown with Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [isDropdownOpen]);

  // Sync pairing status with localStorage and WebRTC context
  useEffect(() => {
    const check = (maybeId?: string | null) => {
      try {
        const id = (typeof maybeId !== 'undefined') ? maybeId : (typeof window !== 'undefined' ? window.localStorage.getItem('pairingRoomId') : null);
        setPairingId(id);
        // Check if truly paired (WebRTC context) or just in pairing state (localStorage)
        if (webrtcContext?.isPaired) {
          setPaired(true);
          setPairing(false);
        } else if (id) {
          setPaired(false);
          setPairing(true);
        } else {
          setPaired(false);
          setPairing(false);
        }
      } catch {
        setPairingId(null);
        setPaired(false);
        setPairing(false);
      }
    };

    check();

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pairingRoomId') check();
    };
    const onPairingChanged = (e: Event) => {
      try {
        const ce = e as CustomEvent;
        check(ce?.detail?.pairingRoomId ?? null);
      } catch {
        check();
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('pairing-changed', onPairingChanged as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pairing-changed', onPairingChanged as EventListener);
    };
  }, [webrtcContext?.isPaired]);

  const handleCopyPairingId = async () => {
    if (!pairingId) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      console.warn('Clipboard not available');
      return;
    }
    try {
      await navigator.clipboard.writeText(pairingId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Failed to copy pairing id', e);
    }
  }; 


  return (
    <nav className="bg-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
        <div className="flex justify-between items-center h-20">
          
          {/* LEFT COLUMN: Logo */}
          <div>
            <Link href="/client"
              className="flex gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">
              {/* 💡 IconLogo */}
              <Image
                src="/assets/iconlogo.png"
                alt="Logo Icon"
                width={40}
                height={40}
                className="h-10 w-auto cursor-pointer"
                style={{ width: 'auto' }}
              />
              {/* 💡 TextLogo */}
              <Image
                src="/assets/textlogo.svg"
                alt="Brand Name"
                width={120}
                height={32}
                className="h-8 w-auto cursor-pointer hidden sm:block"
                style={{ width: 'auto' }}
              />
            </Link>
          </div>

          {/* RIGHT COLUMN: Pairing status + Profile Icon */}
          <div className="hidden sm:flex items-center mr-4">
            {paired ? (
              <div className="flex items-center space-x-2 bg-green-50 border border-green-200 text-green-800 px-3 py-1 rounded-full text-sm">
                <span className="h-2 w-2 bg-green-500 rounded-full inline-block" />
                <span title={pairingId ?? undefined}>{`Paired: ${pairingId ? pairingId.slice(0,8) : 'unknown'}`}</span>
                <button onClick={handleCopyPairingId} aria-label="Copy pairing id" className="ml-2 text-xs text-green-700 hover:text-green-900">{copied ? 'Copied' : 'Copy'}</button>
              </div>
            ) : pairing ? (
              <div className="flex items-center space-x-2 bg-blue-50 border border-blue-200 text-blue-800 px-3 py-1 rounded-full text-sm">
                <span className="h-2 w-2 bg-blue-500 rounded-full inline-block animate-pulse" />
                <span title={pairingId ?? undefined}>{`Pairing: ${pairingId ? pairingId.slice(0,8) : 'unknown'}`}</span>
              </div>
            ) : (
              <div className="text-sm text-gray-500">Not paired</div>
            )}
          </div>

          {/* RIGHT COLUMN: Profile Icon with Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={toggleDropdown}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleDropdown();
                }
              }}
              aria-haspopup="menu"
              aria-expanded={isDropdownOpen}
              aria-controls="nav-profile-menu"
              aria-label="Profile menu"
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
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg py-2 z-50 border border-gray-200" role="menu" id="nav-profile-menu">
                
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

                {paired && (
                  <div className="px-4 py-2 border-b border-gray-200 sm:hidden">
                    <div className="flex items-center justify-between text-sm text-gray-700">
                      <div className="truncate mr-2">{pairingId ? `Paired: ${pairingId.slice(0,8)}` : 'Paired'}</div>
                      <button
                        onClick={() => {
                          handleCopyPairingId();
                          setIsDropdownOpen(false);
                        }}
                        aria-label="Copy pairing id"
                        className="text-xs text-green-700 hover:text-green-900"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}

                {pairing && !paired && (
                  <div className="px-4 py-2 border-b border-gray-200 sm:hidden">
                    <div className="flex items-center justify-between text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 bg-blue-500 rounded-full inline-block animate-pulse" />
                        <span className="truncate mr-2">{pairingId ? `Pairing: ${pairingId.slice(0,8)}` : 'Pairing'}</span>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    router.push('/admin');
                    setIsDropdownOpen(false);
                  }}
                  role="menuitem"
                  className="w-full flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="mr-3 text-gray-500 text-lg">📊</span>
                  <span>Switch to Guardian</span>
                </button>

                <Link href="/client/account"
                  onClick={() => setIsDropdownOpen(false)}
                  role="menuitem"
                  className="w-full flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <Settings size={18} className="mr-3 text-gray-500" />
                  <span>Account Settings</span>
                </Link>
                <Link href="/client/privacy"
                  onClick={() => setIsDropdownOpen(false)}
                  role="menuitem"
                  className="w-full flex items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <FileText size={18} className="mr-3 text-gray-500" />
                  <span>Privacy Policy</span>
                </Link>
                <button
                  onClick={() => { setIsDropdownOpen(false); handleSignOut(); }}
                  disabled={isSigningOut}
                  aria-label="Sign out"
                  role="menuitem"
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