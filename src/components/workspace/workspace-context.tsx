"use client";

import { createContext, useContext, type ReactNode } from "react";

const WorkspaceContext = createContext<Record<string, any> | null>(null);

export function WorkspaceProvider({value,children}:{value:Record<string,any>;children:ReactNode}){
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(){
  const value=useContext(WorkspaceContext);
  if(!value)throw new Error("Workspace page components must be rendered inside WorkspaceProvider.");
  return value;
}
