"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-white group-[.toaster]:text-black group-[.toaster]:border-ios-gray5 group-[.toaster]:shadow-ios-lg group-[.toaster]:rounded-2xl",
          description: "group-[.toast]:text-ios-gray1",
          actionButton:
            "group-[.toast]:bg-ios-blue group-[.toast]:text-white group-[.toast]:rounded-xl",
          cancelButton:
            "group-[.toast]:bg-ios-gray5 group-[.toast]:text-ios-gray1 group-[.toast]:rounded-xl",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
