import React from "react";

export function Alert(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="alert" {...props} />;
}

export function AlertDescription(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
