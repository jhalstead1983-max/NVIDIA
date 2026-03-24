import React from "react";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: string;
};

export function Badge(props: BadgeProps) {
  const { variant, ...rest } = props;
  return <span data-variant={variant} {...rest} />;
}
