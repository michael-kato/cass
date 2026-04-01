
# Project Memory: CASS Website

## 🎯 Tech Stack
- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS (Strict Utility-First)
- **Payments:** Stripe Checkout (Hosted)
- **Deployment:** Vercel

## 🛠 Project Structure
- `/app`: Next.js routes
- `/components`: Shared UI (Radix/Lucide icons)
- `/lib`: Stripe & Utility functions
- `/public`: Optimized AVIF/WebP assets

## ⚖️ Rules & Constraints (Token Savers)
1. **No Refactoring:** Do not rewrite existing working code unless requested.
2. **Tailwind Only:** Never generate raw CSS files. Use inline utility classes.
3. **Stripe Logic:** Use Stripe-hosted checkout links to avoid building complex cart state.
4. **DRY:** If a component exists in `/components`, reuse it. Do not recreate.
5. **Concise Mode:** Provide code blocks only. Skip the "Certainly! I'd be happy to help" fluff.

## 🔑 Key State & IDs
- **Stripe Public Key:** [Insert Test Key Here]
- **Merch Item 1 (T-Shirt):** TODO: We probably want this to be JSON...

## 🏃 Recent Progress
- Initialized Next.js project.
- Connected Vercel deployment.
- [ ] Next Task: Create `ProductCard.tsx` with Stripe Redirect.