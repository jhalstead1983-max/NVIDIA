import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: string;
};

export function Button(props: ButtonProps) {
  const { type, ...rest } = props;
  return <button type={type ?? "button"} {...rest} />;
}
