import { createClient } from '@/lib/supabase/server'
import { Nav } from './_components/landing/nav'
import { Hero } from './_components/landing/hero'
import { SocialProof } from './_components/landing/social-proof'
import { Features } from './_components/landing/features'
import { HowItWorks } from './_components/landing/how-it-works'
import { Pricing } from './_components/landing/pricing'
import { Testimonials } from './_components/landing/testimonials'
import { Faq } from './_components/landing/faq'
import { CtaFooter } from './_components/landing/cta-footer'

export default async function LandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthenticated = !!user

  return (
    <>
      <Nav isAuthenticated={isAuthenticated} />
      <main>
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <Pricing />
        <Testimonials />
        <Faq />
      </main>
      <CtaFooter />
    </>
  )
}
