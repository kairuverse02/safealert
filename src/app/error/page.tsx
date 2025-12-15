'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ErrorPage() {
  const searchParams = useSearchParams();
  const message = searchParams.get('message') || 'An error occurred. Please try again.';
  const reason = searchParams.get('reason');

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-red-600">Error</CardTitle>
          <CardDescription>
            Something went wrong
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-700">
            {message}
          </p>
          {reason && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-xs text-red-800">
                <strong>Details:</strong> {reason}
              </p>
            </div>
          )}
          <div className="pt-4 space-y-2">
            <Link href="/login" className="block">
              <Button className="w-full bg-[#E7473C] hover:bg-[#D9271B]">
                Back to Login
              </Button>
            </Link>
            <Link href="/signup" className="block">
              <Button variant="outline" className="w-full">
                Sign Up
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}