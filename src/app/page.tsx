import UserProfile from "@/components/userProfile";
import Header from "@/components/Header";

export default function Home() {
  return (
    <>
      <Header />
      <h1 className="text-red-400">Hello welcome to entry point!</h1>
      <UserProfile />
    </>
  );
}
