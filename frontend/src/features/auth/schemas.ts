import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean(),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registrationSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(255),
  email: z.string().trim().email('Enter a valid email address.'),
  phone: z.string().trim().refine(value => !value || /^[0-9+()\s-]{7,30}$/.test(value), 'Enter a valid phone number, or leave it blank.'),
  password: z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9\s]/),
  confirm: z.string(),
  terms: z.boolean().refine(Boolean, 'Accept the terms of use to create an account.'),
  staff: z.boolean(),
}).refine(value => value.password === value.confirm, { path: ['confirm'], message: 'The passwords do not match.' })
export type RegistrationValues = z.infer<typeof registrationSchema>
