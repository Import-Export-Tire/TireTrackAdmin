"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuth } from "../auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { admin, updateAdminState } = useAuth();

  const changePassword = useMutation(api.auth.changePassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    if (currentPassword === newPassword) {
      toast.error("New password must be different from current password");
      return;
    }

    setIsLoading(true);

    const result = await changePassword({
      adminId: admin?.id as any,
      currentPassword,
      newPassword,
    });

    if (result.success) {
      updateAdminState({ forcePasswordChange: false });
      router.push("/");
    } else {
      toast.error(result.error ?? "Failed to change password");
    }

    setIsLoading(false);
  };

  if (!admin) {
    router.push("/login");
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-6">
          <p className="text-sm text-muted-foreground text-center">
            You must change your temporary password before continuing.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current">Current password</Label>
              <Input
                id="current"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
                placeholder="Your temporary password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new">New password</Label>
              <Input
                id="new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Confirm new password"
              />
            </div>
            <div className="pt-2">
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Changing…" : "Change password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
