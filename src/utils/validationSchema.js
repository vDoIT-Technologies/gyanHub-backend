import z from 'zod';

/**
 * Schema for validating user registration input.
 * Ensures that the name, email, and password meet specific requirements.
 */
export const registerSchema = z.object({
    /**
     * Validates the user's name.
     * - Minimum length: 2 characters.
     */
    name: z.string().min(2, 'Name must be at least 2 characters long'),
    /**
     * Validates the user's email address.
     * - Must follow a valid email format.
     */
    email: z.string().email('Invalid email format'),
    /**
     * Validates the user's password.
     * - Minimum length: 8 characters.
     * - Maximum length: 64 characters.
     * - Must include at least one uppercase letter, one lowercase letter, one number, and one special character.
     */
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters long')
        .max(64, 'Password must not exceed 64 characters')
        .refine((password) => /[A-Z]/.test(password), {
            message: 'Password must include at least one uppercase letter (A-Z).'
        })
        .refine((password) => /[a-z]/.test(password), {
            message: 'Password must include at least one lowercase letter (a-z).'
        })
        .refine((password) => /[0-9]/.test(password), {
            message: 'Password must include at least one number (0-9).'
        })
        .refine((password) => /[!@#$%^&*(),.?":{}|<>]/.test(password), {
            message: 'Password must include at least one special character (e.g., !, @, #, $, etc.).'
        })
});

/**
 * Schema for validating password reset input.
 * Ensures that the new password meets specific requirements.
 */
export const resetPasswordSchema = z.object({
    /**
     * Validates the new password.
     * - Minimum length: 8 characters.
     * - Maximum length: 64 characters.
     * - Must include at least one uppercase letter, one lowercase letter, one number, and one special character.
     */
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters long')
        .max(64, 'Password must not exceed 64 characters')
        .refine((password) => /[A-Z]/.test(password), {
            message: 'Password must include at least one uppercase letter (A-Z).'
        })
        .refine((password) => /[a-z]/.test(password), {
            message: 'Password must include at least one lowercase letter (a-z).'
        })
        .refine((password) => /[0-9]/.test(password), {
            message: 'Password must include at least one number (0-9).'
        })
        .refine((password) => /[!@#$%^&*(),.?":{}|<>]/.test(password), {
            message: 'Password must include at least one special character (e.g., !, @, #, $, etc.).'
        })
});
