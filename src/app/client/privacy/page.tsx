import React from 'react'

const page = () => {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header Section */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
          <p className="text-lg text-gray-700 leading-relaxed">
            SafeAlert collects and processes your information to provide real-time monitoring, perimeter detection, and alert notifications.
            We only collect the data needed for system functionality, such as your account details, device pairing information, and real-time event logs.
          </p>
        </div>

        {/* Full Privacy Policy Section */}
        <div className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">FULL PRIVACY POLICY</h2>
          <p className="text-base text-gray-700 leading-relaxed">
            This Privacy Policy explains how SafeAlert: Web-Based Human Monitoring System with Perimeter Detection (&quot;SafeAlert,&quot; &quot;we,&quot; &quot;us,&quot; &quot;our&quot;)
            collects, uses, stores, and protects information from its users and monitored subjects, in full compliance with the Data Privacy Act of 2012 (RA 10173).
          </p>
        </div>

        {/* Section 1: Data Collection */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">1. Data Collection</h3>
          <p className="text-base text-gray-700 mb-6 leading-relaxed">SafeAlert collects only the information necessary for the operation of the monitoring system.</p>
          
          <div className="space-y-8">
            {/* User Data */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">a. User Data</h4>
              <ul className="list-disc list-inside space-y-2 mb-4 text-gray-700">
                <li className="text-base">Name</li>
                <li className="text-base">Email Address</li>
                <li className="text-base">Encrypted login credentials</li>
              </ul>
              <p className="text-base text-gray-600 italic">Purpose: Account creation, authentication, and access to the dashboard.</p>
            </div>

            {/* System Operational Data */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">b. System Operational Data</h4>
              <ul className="list-disc list-inside space-y-2 mb-4 text-gray-700">
                <li className="text-base">Device IDs</li>
                <li className="text-base">QR-based pairing token</li>
                <li className="text-base">Perimeter setup information</li>
                <li className="text-base">Notification preferences (push notification only)</li>
                <li className="text-base">Alert actions (ex. snooze, acknowledge)</li>
              </ul>
              <p className="text-base text-gray-600 italic">Purpose: To facilitate device pairing, perimeter detection, and alert notifications.</p>
            </div>

            {/* Monitored Data */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">c. Monitored Data (Sensitive Personal Information)</h4>
              <div className="mb-4">
                <h5 className="font-semibold text-gray-900 mb-2">Real-Time Video & Audio Feed</h5>
                <ul className="list-disc list-inside space-y-2 mb-3 text-gray-700">
                  <li className="text-base">Live stream from the monitoring device</li>
                </ul>
                <p className="text-base text-gray-600 italic">Purpose: Allows guardians to monitor activity and enables perimeter detection algorithms.</p>
                <p className="text-base text-gray-600 italic mt-2">Note: The live video is not recorded or stored long-term.</p>
              </div>
              <div>
                <h5 className="font-semibold text-gray-900 mb-2">Event Log Data</h5>
                <ul className="list-disc list-inside space-y-2 mb-3 text-gray-700">
                  <li className="text-base">Perimeter breach triggers</li>
                  <li className="text-base">Motion detection events</li>
                  <li className="text-base">Device online/offline status</li>
                  <li className="text-base">Guardian actions taken during monitoring</li>
                </ul>
                <p className="text-base text-gray-600 italic">Purpose: To provide activity reports and safety documentation.</p>
              </div>
            </div>

            {/* Pairing Data */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">d. Pairing Data</h4>
              <ul className="list-disc list-inside space-y-2 mb-4 text-gray-700">
                <li className="text-base">One-time QR token generated during device pairing</li>
              </ul>
              <p className="text-base text-gray-600 italic">Purpose: Securely link the device to the user&apos;s account.</p>
              <p className="text-base text-gray-600 italic mt-2">Note: Token is immediately invalidated after a successful pairing.</p>
            </div>
          </div>
        </div>

        {/* Section 2: How We Use Your Data */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">2. How We Use Your Data</h3>
          <p className="text-base text-gray-700 mb-6 leading-relaxed">SafeAlert processes collected data strictly to:</p>
          <ul className="list-disc list-inside space-y-2 mb-6 text-gray-700">
            <li className="text-base">Enable live monitoring</li>
            <li className="text-base">Detect perimeter breaches</li>
            <li className="text-base">Trigger real-time push notifications</li>
            <li className="text-base">Securely pair monitoring devices</li>
            <li className="text-base">Generate event logs for exporting (PDF/Excel)</li>
            <li className="text-base">Maintain system stability and performance</li>
          </ul>
          <p className="text-base text-gray-700 italic leading-relaxed">SafeAlert does not send SMS and does not collect phone numbers.</p>
        </div>

        {/* Section 3: Data Storage, Security, and Retention */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">3. Data Storage, Security, and Retention</h3>
          
          <div className="space-y-8">
            {/* Data Storage & Security */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">a. Data Storage & Security</h4>
              <ul className="list-disc list-inside space-y-2 text-gray-700">
                <li className="text-base">All data transfers are encrypted (HTTPS/SSL)</li>
                <li className="text-base">User passwords are fully hashed</li>
                <li className="text-base">Logs stored only within the active session</li>
                <li className="text-base">Backend storage is secured using Supabase/PostgreSQL</li>
              </ul>
            </div>

            {/* Data Retention */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-3">b. Data Retention</h4>
              <ul className="list-disc list-inside space-y-2 mb-4 text-gray-700">
                <li className="text-base">SafeAlert follows a session-based retention model:</li>
                <li className="text-base">Event logs exist only during the active live monitoring session</li>
                <li className="text-base">When the user starts a live monitoring session → logs begin to generate</li>
                <li className="text-base">When the user ends or closes the live monitoring session → logs are deleted automatically</li>
                <li className="text-base">Users may export logs (PDF or Excel) anytime before session ends</li>
                <li className="text-base">No long-term storage of monitoring logs after the session closes</li>
              </ul>
              <p className="text-base text-gray-700 leading-relaxed">This ensures maximum privacy and prevents unnecessary storage of sensitive monitoring data.</p>
            </div>
          </div>
        </div>

        {/* Section 4: Disclosure of Data */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">4. Disclosure of Data</h3>
          <p className="text-base text-gray-700 mb-6 leading-relaxed">SafeAlert does not share, sell, or rent any personal or sensitive information.</p>
          <p className="text-base text-gray-700 mb-4 leading-relaxed">Data may only be disclosed when:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li className="text-base">Required by law (e.g., subpoena, court order)</li>
            <li className="text-base">Necessary for system hosting (Supabase), strictly for technical operations</li>
          </ul>
        </div>

        {/* Section 5: User Rights */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">5. User Rights</h3>
          <p className="text-base text-gray-700 mb-4 leading-relaxed">Users have the right to:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li className="text-base">Access their stored personal data</li>
            <li className="text-base">Request correction of inaccurate information</li>
            <li className="text-base">Export their session logs before the monitoring session ends</li>
            <li className="text-base">Request deletion or deactivation of their account</li>
            <li className="text-base">Withdraw consent at any time</li>
            <li className="text-base">File complaints with the National Privacy Commission</li>
          </ul>
        </div>

        {/* Section 6: Changes to This Privacy Policy */}
        <div className="pb-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">6. Changes to This Privacy Policy</h3>
          <p className="text-base text-gray-700 leading-relaxed">SafeAlert may update this Privacy Policy periodically.</p>
        </div>
      </div>
    </div>
  )
}

export default page
