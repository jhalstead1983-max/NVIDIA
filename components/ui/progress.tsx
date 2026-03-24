import React from "react";

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
};

export function Progress(props: ProgressProps) {
  const { value = 0, ...rest } = props;
  return <div aria-valuenow={value} role="progressbar" {...rest} />;
}
