"use client";

import Link from "next/link";

// Added FocusEvent for handleBlur and FC for the component type.
import React, {
  useState,
  type FC,
  type ChangeEvent,
  type FormEvent,
  type FocusEvent,
} from "react";
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
  "confirm-password": string;
}

// --- Define the shape of our errors ---
// It can have *some* or all keys from FormData
type FormErrors = Partial<Record<keyof FormData, string>>;

/**
 * A central validation function.
 * It takes the field name and its value, and returns an error message or an empty string.
 */
const validate = (name: keyof FormData, value: string, allFormData?: FormData): string => {
  switch (name) {
    case "first-name":
      return value.trim() ? "" : "First name is required.";
    case "last-name":
      return value.trim() ? "" : "Last name is required.";
    case "email":
      if (!value) return "Email is required.";
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(value) ? "" : "Please enter a valid email.";
    case "password":
      if (!value) return "Password is required.";
      
      // --- REVISED VALIDATION ---
      const passErrors: string[] = [];
      if (value.length < 8) {
        passErrors.push("8 characters");
      }
      if (!/[A-Z]/.test(value)) {
        passErrors.push("one uppercase letter");
      }
      if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) {
        passErrors.push("one special character");
      }
      return passErrors.length > 0
        ? `Needs at least ${passErrors.join(", ")}.`
        : "";
    case "confirm-password":
      if (!value) return "Please confirm your password.";
      if (allFormData && allFormData.password !== value) {
        return "Passwords do not match.";
      }
      return "";
    default:
      return "";
  }
};

export const SignUpForm: FC = () => {
  // State to hold the form values, explicitly typed
  const [formData, setFormData] = useState<FormData>({
    "first-name": "",
    "last-name": "",
    email: "",
    password: "",
    "confirm-password": "",
  });

  // State to hold the error messages, explicitly typed
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State for password visibility
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  /**
   * Handles changes to any input field.
   */
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    // --- REVISION: Cleaner key typing
    const { name, value } = e.target;
    const formKey = name as keyof FormData;

    const updatedFormData = {
      ...formData,
      [formKey]: value,
    };

    setFormData(updatedFormData);

    // --- Real-time validation for ALL fields ---
    const error = validate(formKey, value, updatedFormData);
    setErrors((prev) => ({
      ...prev,
      [formKey]: error,
    }));
    
    // If password changes, also re-validate confirm-password
    if (formKey === "password" && updatedFormData["confirm-password"]) {
      const confirmError = validate("confirm-password", updatedFormData["confirm-password"], updatedFormData);
      setErrors((prev) => ({
        ...prev,
        "confirm-password": confirmError,
      }));
    }
  };

  /**
   * Handles the "blur" event (when a user clicks out of an input).
   */
  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    // --- REVISION: Cleaner key typing
    const { name, value } = e.target;
    const formKey = name as keyof FormData;

    const error = validate(formKey, value, formData);
    setErrors((prev) => ({
      ...prev,
      [formKey]: error,
    }));
  };

  /**
   * Handles the form submission.
   */
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); // Prevent default form submission

    // --- Final validation check on all fields ---
    const newErrors: FormErrors = {};
    let isValid = true;

    (Object.keys(formData) as Array<keyof FormData>).forEach((key) => {
      const error = validate(key, formData[key], formData);
      if (error) {
        newErrors[key] = error;
        isValid = false;
      }
    });

    setErrors(newErrors); // Show all errors on submit attempt

    if (isValid) {
      setIsSubmitting(true);
      console.log("Form is valid, submitting to server action...");
      const formDataForServer = new FormData();

      (Object.keys(formData) as Array<keyof FormData>).forEach((key) => {
        formDataForServer.append(key, formData[key]);
      });

      try {
        await signup(formDataForServer);
      } catch (err) {
        console.error('Signup error:', err);
        setErrors({ email: (err as Error).message || 'Signup failed' });
        setIsSubmitting(false);
      }
    } else {
      console.log("Form has errors.", newErrors);
    }
  };

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-[#E7473C]">
          Sign Up
        </CardTitle>
        <CardDescription>
          Enter your information to create an account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Add the onSubmit handler to the form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              
              {/* --- First Name (with Accessibility) --- */}
              <div className="grid gap-2">
                <Label htmlFor="first-name">First name*</Label>
                <Input
                  name="first-name"
                  id="first-name"
                  placeholder="First Name"
                  value={formData["first-name"]}
                  onChange={handleChange}
                  onBlur={handleBlur} // Validate on blur
                  // --- A11Y (Accessibility) ---
                  aria-invalid={!!errors["first-name"]}
                  aria-describedby="first-name-error"
                  className={errors["first-name"] ? "border-red-500" : ""}
                />
                {errors["first-name"] && (
                  <p id="first-name-error" className="text-xs text-red-600">
                    {errors["first-name"]}
                  </p>
                )}
              </div>

              {/* --- Last Name (with Accessibility) --- */}
              <div className="grid gap-2">
                <Label htmlFor="last-name">Last name*</Label>
                <Input
                  name="last-name"
                  id="last-name"
                  placeholder="Last Name"
                  value={formData["last-name"]}
                  onChange={handleChange}
                  onBlur={handleBlur} // Validate on blur
                  // --- A11Y (Accessibility) ---
                  aria-invalid={!!errors["last-name"]}
                  aria-describedby="last-name-error"
                  className={errors["last-name"] ? "border-red-500" : ""}
                />
                {errors["last-name"] && (
                  <p id="last-name-error" className="text-xs text-red-600">
                    {errors["last-name"]}
                  </p>
                )}
              </div>
            </div>

            {/* --- Email (with Accessibility) --- */}
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
                // --- A11Y (Accessibility) ---
                aria-invalid={!!errors.email}
                aria-describedby="email-error"
                className={errors.email ? "border-red-500" : ""}
              />
              {errors.email && (
                <p id="email-error" className="text-xs text-red-600">
                  {errors.email}
                </p>
              )}
            </div>

            {/* --- Password (with Accessibility) --- */}
            <div className="grid gap-2">
              <Label htmlFor="password">Password*</Label>
              <div className="relative">
                <Input
                  name="password"
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a Password"
                  value={formData.password}
                  onChange={handleChange} // Validate on change
                  onBlur={handleBlur}     // Also validate on blur
                  // --- A11Y (Accessibility) ---
                  aria-invalid={!!errors.password}
                  aria-describedby="password-error"
                  className={errors.password ? "border-red-500" : ""}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="text-xs text-red-600">
                  {errors.password}
                </p>
              )}
            </div>

            {/* --- Confirm Password (with Accessibility) --- */}
            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm Password*</Label>
              <div className="relative">
                <Input
                  name="confirm-password"
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm Your Password"
                  value={formData["confirm-password"]}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  // --- A11Y (Accessibility) ---
                  aria-invalid={!!errors["confirm-password"]}
                  aria-describedby="confirm-password-error"
                  className={errors["confirm-password"] ? "border-red-500" : ""}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                </button>
              </div>
              {errors["confirm-password"] && (
                <p id="confirm-password-error" className="text-xs text-red-600">
                  {errors["confirm-password"]}
                </p>
              )}
            </div>

            {/* Remove `formAction` and just use `type="submit"` */}
            <Button type="submit" className="w-full bg-[#E7473C]" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account...' : 'Create an account'}
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
};