import React from "react";

type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked?: boolean;
  onCheckedChange?: (value: boolean) => void;
};

export function Switch(props: SwitchProps) {
  const { checked = false, onCheckedChange, type, ...rest } = props;

  return (
    <button
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      role="switch"
      type={type ?? "button"}
      {...rest}
    />
  );
}
