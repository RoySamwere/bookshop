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
  bookshop: z.string().trim().max(80).optional(),
}).refine(value => value.password === value.confirm, { path: ['confirm'], message: 'The passwords do not match.' })
  .refine(value => !value.staff || Boolean(value.bookshop), { path: ['bookshop'], message: 'Enter the code of the bookshop you work at.' })
export type RegistrationValues = z.infer<typeof registrationSchema>

const phone = z.string().trim().regex(/^[0-9+()\s-]{7,30}$/, 'Enter a valid phone number.')

export const bookshopRegistrationSchema = z.object({
  owner_name: z.string().trim().min(2, 'Enter your full name.').max(255),
  email: z.string().trim().email('Enter a valid email address.'),
  phone,
  password: z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9\s]/),
  confirm: z.string(),
  bookshop_name: z.string().trim().min(2, 'Enter your bookshop name.').max(120),
  business_phone: phone,
  business_location: z.string().trim().min(2, 'Enter the town or street where the shop is.').max(255),
  country: z.string().trim().min(2, 'Choose a country.').max(100),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a three-letter code such as KES.'),
  terms: z.boolean().refine(Boolean, 'Accept the terms of use to register your bookshop.'),
}).refine(value => value.password === value.confirm, { path: ['confirm'], message: 'The passwords do not match.' })
export type BookshopRegistrationValues = z.infer<typeof bookshopRegistrationSchema>
