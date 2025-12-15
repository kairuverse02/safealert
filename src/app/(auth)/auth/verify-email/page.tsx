import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Verify Your Email</CardTitle>
          <CardDescription>
            A verification link has been sent to your email address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Please check your inbox and click the verification link to confirm your account. 
            The link will expire after some time.
          </p>
          
          <div className="pt-4 space-y-2">
            <p className="text-xs text-gray-500">
              Didn't receive an email? Check your spam folder or try signing up again.
            </p>
            <Link href="/signup">
              <Button variant="outline" className="w-full">
                Back to Sign Up
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
