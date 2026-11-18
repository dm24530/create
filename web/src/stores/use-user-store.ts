import { create } from "zustand";

import type { CreateSession, CreateUser } from "@/services/create-auth";

export type LocalUser = CreateUser;

type UserStore = {
    user: LocalUser | null;
    session: CreateSession | null;
    setSession: (session: CreateSession) => void;
    setUser: (user: LocalUser | null) => void;
    clearSession: () => void;
};

export const useUserStore = create<UserStore>()((set) => ({
    user: null,
    session: null,
    setSession: (session) => set({ session, user: session.user }),
    setUser: (user) => set({ user }),
    clearSession: () => set({ session: null, user: null }),
}));
