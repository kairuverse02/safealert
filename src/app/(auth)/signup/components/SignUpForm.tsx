// Add "use client" at the top to make this a Client Component
"use client";

import Link from "next/link";
import React, { useState }  from "react"; // Import React and useState
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signup } from "@/lib/auth-actions"; // Your server action

// --- Define the shape of our form data ---
interface FormData {
  "first-name": string;
  "last-name": string;
  email: string;
  password: string;
}

// --- Define the shape of our errors ---
// It can have *some* or all keys from FormData
type FormErrors = Partial<Record<keyof FormData, string>>;


/**
 * A central validation function.
 * It takes the field name and its value, and returns an error message or an empty string.
 */
const validate = (name: keyof FormData, value: string): string => {
  switch (name) {
    case 'first-name':
      return value.trim() ? '' : 'First name is required.';
    case 'last-name':
      return value.trim() ? '' : 'Last name is required.';
    case 'email':
      if (!value) return 'Email is required.';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(value) ? '' : 'Please enter a valid email.';
    case 'password':
      if (!value) return 'Password is required.';
      const passErrors: string[] = [];
      if (!/[A-Z]/.test(value)) {
        passErrors.push('one uppercase letter');
      }
      if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) {
        passErrors.push('one special character');
      }
      return passErrors.length > 0
        ? `Needs at least ${passErrors.join(' & ')}.`
        : '';
    default:
      return '';
  }
};


export function SignUpForm() {
  // State to hold the form values, explicitly typed
  const [formData, setFormData] = useState<FormData>({
    'first-name': '',
    'last-name': '',
    email: '',
    password: '',
  });

  // State to hold the error messages, explicitly typed
  const [errors, setErrors] = useState<FormErrors>({});

  /**
   * Handles changes to any input field.
   * Explicitly type the event 'e'.
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // We can be sure 'name' is one of our FormData keys
    const { name, value } = e.target as { name: keyof FormData; value: string };
    
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));

    // --- Real-time validation for email and password ---
    if (name === 'email' || name === 'password') {
      const error = validate(name, value);
      setErrors(prev => ({
        ...prev,
        [name]: error,
      }));
    }
  };

  /**
   * Handles the "blur" event (when a user clicks out of an input).
   * Explicitly type the event 'e'.
   */
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target as { name: keyof FormData; value: string };
    const error = validate(name, value);
    setErrors(prev => ({
      ...prev,
      [name]: error,
    }));
  };

  /**
   * Handles the form submission.
   * Explicitly type the event 'e'.
   */
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); // Prevent default form submission
    
    // --- Final validation check on all fields ---
    const newErrors: FormErrors = {};
    let isValid = true;

    // Explicitly cast the keys to our FormData keys
    (Object.keys(formData) as Array<keyof FormData>).forEach(key => {
      const error = validate(key, formData[key]);
      if (error) {
        newErrors[key] = error;
        isValid = false;
      }
    });

    setErrors(newErrors); // Show all errors on submit attempt

    if (isValid) {
      // If valid, create FormData and call the server action
      console.log("Form is valid, submitting to server action...");
      const formDataForServer = new FormData();
      
      (Object.keys(formData) as Array<keyof FormData>).forEach(key => {
        formDataForServer.append(key, formData[key]);
      });
      
      // Call your server action
      signup(formDataForServer);
      
    } else {
      console.log('Form has errors.', newErrors);
    }
  };


  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-[#E7473C]">Sign Up</CardTitle>
        <CardDescription>
          Enter your information to create an account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Add the onSubmit handler to the form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              
              {/* --- First Name --- */}
              <div className="grid gap-2">
                <Label htmlFor="first-name">First name*</Label>
                <Input
                  name="first-name"
                  id="first-name"
                  placeholder="First Name"
                  value={formData['first-name']}
                  onChange={handleChange}
                  onBlur={handleBlur} // Validate on blur
                  // Conditionally add red border for error
                  className={errors['first-name'] ? 'border-red-500' : ''}
                />
                {/* Show error message */}
                {errors['first-name'] && (
                  <p className="text-xs text-red-600">{errors['first-name']}</p>
                )}
              </div>
              
              {/* --- Last Name --- */}
              <div className="grid gap-2">
                <Label htmlFor="last-name">Last name*</Label>
                <Input
                  name="last-name"
                  id="last-name"
                  placeholder="Last Name"
                  value={formData['last-name']}
                  onChange={handleChange}
                  onBlur={handleBlur} // Validate on blur
                  className={errors['last-name'] ? 'border-red-500' : ''}
                />
                {errors['last-name'] && (
                  <p className="text-xs text-red-600">{errors['last-name']}</p>
                )}
              </div>
            </div>
            
            {/* --- Email --- */}
            <div className="grid gap-2">
              <Label htmlFor="email">Email*</Label>
              <Input
                name="email"
                id="email"
                type="email"
                placeholder="Your Email Address"
                value={formData.email}
                onChange={handleChange} // Validate on change
                onBlur={handleBlur}     // Also validate on blur
                className={errors.email ? 'border-red-500' : ''}
              />
              {errors.email && (
                <p className="text-xs text-red-600">{errors.email}</p>
              )}
            </div>
            
            {/* --- Password --- */}
            <div className="grid gap-2">
              <Label htmlFor="password">Password*</Label>
              <Input
                name="password"
                id="password"
                type="password"
                placeholder="Create a Password"
                value={formData.password}
                onChange={handleChange} // Validate on change
                onBlur={handleBlur}     // Also validate on blur
                className={errors.password ? 'border-red-500' : ''}
              />
              {errors.password && (
                <p className="text-xs text-red-600">{errors.password}</p>
              )}
            </div>
            
            {/* Remove `formAction` and just use `type="submit"` */}
            <Button type="submit" className="w-full bg-[#E7473C]">
              Create an account
            </Button>
          </div>
        </form>
        <div className="mt-4 text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className="underline text-[#E7473C]">
            Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}