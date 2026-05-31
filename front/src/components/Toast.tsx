import React from "react";

export interface ToastMessage {
  id: string;
  type: string;
  message: string;
  timestamp: Date;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  const getToastIcon = (type: string) => {
    switch (type) {
      case "image.processed":
      case "success":
        return (
          <svg className="toast-icon success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "image.process.requested":
      case "image.uploaded":
      case "warning":
        return (
          <svg className="toast-icon warning animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case "project.created":
      case "info":
        return (
          <svg className="toast-icon info" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return (
          <svg className="toast-icon default" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        );
    }
  };

  const getToastClass = (type: string) => {
    if (type.includes("processed") || type === "success") return "toast success";
    if (type.includes("requested") || type.includes("uploaded") || type === "warning") return "toast warning";
    if (type.includes("created") || type === "info") return "toast info";
    return "toast";
  };

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={getToastClass(toast.type)}>
          <div className="toast-content">
            {getToastIcon(toast.type)}
            <div className="toast-text-container">
              <span className="toast-title">{toast.type.replace(/\./g, " ").toUpperCase()}</span>
              <p className="toast-message">{toast.message}</p>
            </div>
            <button className="toast-close" onClick={() => onDismiss(toast.id)}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
