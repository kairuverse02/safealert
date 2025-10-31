import MonitoringPanel from "@/app/admin/components/MonitoringPanel"; 
import UserProfile from "@/components/userProfile";
import ControlBar from "./components/ControlBar";



export default function Home() {
  return (
    <>
      <div>
        <h1 className="text-neutral-950 text-3xl font-semibold w-full max-w-[1200px] mx-auto mt-10">Your Dashboard</h1>
      </div>
      <MonitoringPanel/>
      {/* <ControlBar/> */}
    </>
  );
}
