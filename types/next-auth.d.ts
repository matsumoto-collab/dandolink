import { DefaultSession } from 'next-auth';
import { UserRole } from './user';

declare module 'next-auth' {
    interface Session {
        user: {
            id: string;
            username: string;
            role: UserRole;
            assignedProjects?: string[];
            isActive: boolean;
            teamId?: string | null;
        } & DefaultSession['user'];
    }

    interface User {
        id: string;
        username: string;
        email: string;
        displayName: string;
        role: UserRole;
        assignedProjects?: string[];
        isActive: boolean;
        teamId?: string | null;
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        id: string;
        username: string;
        role: UserRole;
        assignedProjects?: string[];
        isActive: boolean;
        teamId?: string | null;
    }
}
