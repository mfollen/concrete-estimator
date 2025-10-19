import "./../styles/globals.css";

export const metadata = { title: "Concrete Estimator" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <div className="header">
            <div className="nav">
              <a href="/">Home</a>
              <a href="/settings">Settings</a>
            </div>
            <div><strong>Concrete Estimator</strong></div>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
