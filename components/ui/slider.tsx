import React from "react";

type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value?: number[];
  onValueChange?: (value: number[]) => void;
};

export function Slider(props: SliderProps) {
  const { value = [0], onValueChange, min, max, step, ...rest } = props;

  return (
    <input
      max={max}
      min={min}
      onChange={(event) => onValueChange?.([Number(event.target.value)])}
      step={step}
      type="range"
      value={value[0] ?? 0}
      {...rest}
    />
  );
}
