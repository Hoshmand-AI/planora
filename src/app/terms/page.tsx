'use client'
import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface-50">
      <nav className="bg-navy-900 h-14 flex items-center px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-steel-500 rounded-lg flex items-center justify-center text-white font-bold text-[10px] tracking-tight">P</div>
          <span className="text-white font-semibold">Planora</span>
        </Link>
      </nav>
      <div className="max-w-[720px] mx-auto px-6 py-12">
        <h1 className="font-display text-[32px] text-navy-950 mb-2">Terms of Service</h1>
        <p className="text-[13px] text-surface-500 mb-8">Effective Date: March 1, 2026</p>
        <div className="prose prose-sm text-surface-600 space-y-6 text-[15px] leading-relaxed">
          <p>These Terms govern your use of Hoshmand Schedule Intelligence (&quot;HSI&quot;), a product of Hoshmand AI.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">1. Description of Service</h2>
          <p>Planora is an AI-powered construction schedule analysis platform that parses Primavera P6, MS Project, and PDF files to provide health assessments, critical path analysis, variance tracking, and report generation.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">2. AI-Generated Content</h2>
          <p>Planora uses artificial intelligence to analyze schedules. AI-generated analysis is for informational purposes only and should not be the sole basis for project decisions, legal claims, or contractual disputes.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">3. Intellectual Property</h2>
          <p>Planora is owned by Hoshmand AI. Your schedule data remains your property. We claim no ownership over your files or reports.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">4. Limitation of Liability</h2>
          <p>Planora is provided &quot;as is&quot; without warranties. We are not liable for indirect damages arising from use of the service.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">5. Contact</h2>
          <p>Email: support@hoshmand.ai — Website: <a href="https://www.hoshmand.ai" className="text-steel-500">hoshmand.ai</a></p>
        </div>
      </div>
    </div>
  )
}
