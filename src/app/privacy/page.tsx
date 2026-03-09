'use client'
import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface-50">
      <nav className="bg-navy-900 h-14 flex items-center px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-steel-500 rounded-lg flex items-center justify-center text-white font-bold text-[10px] tracking-tight">P</div>
          <span className="text-white font-semibold">Planora</span>
        </Link>
      </nav>
      <div className="max-w-[720px] mx-auto px-6 py-12">
        <h1 className="font-display text-[32px] text-navy-950 mb-2">Privacy Policy</h1>
        <p className="text-[13px] text-surface-500 mb-8">Effective Date: March 1, 2026</p>
        <div className="prose prose-sm text-surface-600 space-y-6 text-[15px] leading-relaxed">
          <p>Hoshmand AI (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates Hoshmand Schedule Intelligence (&quot;HSI&quot;). This Privacy Policy explains how we collect, use, and protect your information.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">1. Information We Collect</h2>
          <p><strong>Account Information:</strong> Name, email address, and authentication credentials.</p>
          <p><strong>Schedule Data:</strong> Construction schedule files (XER, XML, PDF) are processed to provide analysis. Files are parsed on the server and relevant data may be sent to AI providers for analysis.</p>
          <p><strong>Usage Data:</strong> Features accessed, reports generated, and questions asked.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">2. How We Use Your Information</h2>
          <p>To provide schedule analysis, reports, and AI-powered Q&A. To improve the app experience. To communicate about your account. To ensure security.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">3. Data Security</h2>
          <p>Data is encrypted in transit (TLS) and at rest. We do not store raw schedule files longer than necessary.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">4. Data Sharing</h2>
          <p>We do not sell your data. We share data only with AI providers (OpenAI) to process queries, and when required by law.</p>
          <h2 className="text-[18px] font-semibold text-navy-950 mt-8">5. Contact</h2>
          <p>Email: support@hoshmand.ai — Website: <a href="https://www.hoshmand.ai" className="text-steel-500">hoshmand.ai</a></p>
        </div>
      </div>
    </div>
  )
}
