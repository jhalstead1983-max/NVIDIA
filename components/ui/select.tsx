import React, { createContext, useContext, useMemo } from "react";

type SelectItemData = {
  value: string;
  label: React.ReactNode;
};

type SelectContextValue = {
  items: SelectItemData[];
  value?: string;
  onValueChange?: (value: string) => void;
};

const SelectContext = createContext<SelectContextValue | null>(null);

type SelectProps = {
  children: React.ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
};

function collectItems(children: React.ReactNode): SelectItemData[] {
  const items: SelectItemData[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      return;
    }

    if (child.type === SelectItem) {
      items.push({
        label: child.props.children,
        value: child.props.value,
      });
      return;
    }

    if (child.props.children) {
      items.push(...collectItems(child.props.children));
    }
  });

  return items;
}

export function Select(props: SelectProps) {
  const { children, onValueChange, value } = props;
  const items = useMemo(() => collectItems(children), [children]);
  const contextValue = useMemo(
    () => ({ items, onValueChange, value }),
    [items, onValueChange, value],
  );

  return <SelectContext.Provider value={contextValue}>{children}</SelectContext.Provider>;
}

export function SelectTrigger(
  props: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">,
) {
  const context = useContext(SelectContext);
  const { children, ...rest } = props;
  const selectedValue = context?.value ?? context?.items[0]?.value ?? "";

  return (
    <select
      onChange={(event) => context?.onValueChange?.(event.target.value)}
      value={selectedValue}
      {...rest}
    >
      {context?.items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

export function SelectValue() {
  return null;
}

export function SelectContent(props: { children: React.ReactNode }) {
  return null;
}

export function SelectItem(props: { children: React.ReactNode; value: string }) {
  return null;
}
