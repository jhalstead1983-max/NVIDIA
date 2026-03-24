import React, { createContext, useContext, useMemo, useState } from "react";

type TabsContextValue = {
  activeValue: string;
  setActiveValue: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs(props: React.HTMLAttributes<HTMLDivElement> & { defaultValue: string }) {
  const { defaultValue, children, ...rest } = props;
  const [activeValue, setActiveValue] = useState(defaultValue);
  const contextValue = useMemo(() => ({ activeValue, setActiveValue }), [activeValue]);

  return (
    <TabsContext.Provider value={contextValue}>
      <div {...rest}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}

export function TabsTrigger(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string },
) {
  const { value, children, type, ...rest } = props;
  const context = useContext(TabsContext);

  return (
    <button
      aria-pressed={context?.activeValue === value}
      onClick={() => context?.setActiveValue(value)}
      type={type ?? "button"}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TabsContent(props: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const { value, children, ...rest } = props;
  const context = useContext(TabsContext);

  if (context?.activeValue !== value) {
    return null;
  }

  return <div {...rest}>{children}</div>;
}
