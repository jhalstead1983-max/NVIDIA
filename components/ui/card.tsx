import React from "react";

type DivProps = React.HTMLAttributes<HTMLDivElement>;
type HeadingProps = React.HTMLAttributes<HTMLHeadingElement>;
type ParagraphProps = React.HTMLAttributes<HTMLParagraphElement>;

export function Card(props: DivProps) {
  return <div {...props} />;
}

export function CardHeader(props: DivProps) {
  return <div {...props} />;
}

export function CardContent(props: DivProps) {
  return <div {...props} />;
}

export function CardTitle(props: HeadingProps) {
  return <h2 {...props} />;
}

export function CardDescription(props: ParagraphProps) {
  return <p {...props} />;
}
