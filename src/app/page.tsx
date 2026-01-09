import StartButton from "@/components/StartButton";
import Image from 'next/image';


export default function Home() {
  return (
    <main className="min-h-screen text-slate-800 font-sans" style={{ backgroundColor: '#f8f9fa' }}>
      
      {/* --- NAVIGATION BAR --- */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/assets/SafeAlertMainLogo.png" alt="SafeAlert Logo" width={40} height={40} className="border-0" />
            <Image
                src="/assets/textlogo.svg"
                alt="Brand Name"
                width={120}
                height={32}
                className="h-8 w-auto cursor-pointer hidden sm:block"
              />
          </div>
        </div>
      </nav>
      
      {/* --- SECTION 1: HERO --- */}
      <section 
        className="flex flex-col items-start justify-center min-h-[90vh] pl-12 md:pl-24 pr-4 pt-20"
        style={{
          backgroundImage: 'url(/assets/HeroBG.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }}
      >
        <div className="ml-8">
        <span className="text-sm font-bold tracking-widest text-white uppercase px-4 py-2 rounded-full w-fit" style={{ backgroundColor: '#2a7d4d' }}>
          Welcome to SafeAlert!
        </span>

        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-white max-w-3xl mb-6 mt-4">
          Your Home, Secured With <span style={{ color: '#FF5733' }}>Smart Boundaries.</span>
        </h1>
        <p className="text-lg md:text-lg text-white max-w-2xl mb-10 leading-relaxed">
          The intelligent web-based human monitoring system. 
          Set your perimeter, pair your devices, and get real-time alerts instantly.
        </p>
        <div className="transform hover:scale-105 transition duration-200">
          <StartButton />
        </div>
        </div>

      </section>

      {/* --- SECTION 2: PRODUCT FEATURES --- */}
      <section className="py-24 bg-white border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900">Essential Protection</h2>
            <p className="mt-4 text-slate-600">Everything you need to monitor your space effectively.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition">
              <div className="w-10 h-10 rounded mb-4 flex items-center justify-center text-white font-bold" style={{ backgroundColor: '#FF5733' }}>
                1
              </div>
              <h3 className="text-lg font-semibold mb-2 text-slate-900">Live Monitoring</h3>
              <p className="text-slate-600 text-sm">
                Connect two devices and stream video feeds in real-time between them.
              </p>
            </div>
            {/* Feature 2 */}
            <div className="p-8 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition">
              <div className="w-10 h-10 rounded mb-4 flex items-center justify-center text-white font-bold" style={{ backgroundColor: '#2a7d4d' }}>
                2
              </div>
              <h3 className="text-lg font-semibold mb-2 text-slate-900">Perimeter Detection</h3>
              <p className="text-slate-600 text-sm">
                Define custom zones and detect when movement crosses your boundaries.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition">
              <div className="w-10 h-10 rounded mb-4 flex items-center justify-center text-white font-bold" style={{ backgroundColor: '#FF5733' }}>
                3
              </div>
              <h3 className="text-lg font-semibold mb-2 text-slate-900">Instant Alerts</h3>
              <p className="text-slate-600 text-sm">
                Get notified immediately when a breach occurs on your dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-8 text-center text-slate-400 text-sm" style={{ backgroundColor: '#2a7d4d' }}>
        <p className="text-white">© {new Date().getFullYear()} SafeAlert. All rights reserved.</p>
      </footer>

    </main>
  );
}