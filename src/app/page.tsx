import StartButton from "@/components/StartButton";
import Image from "next/image";

export default function Home() {
    return (
        <main>
            <div className="flex flex-col items-center my-50">
                <h1 className="text-5xl font-bold">Welcome to SafeAlert!</h1>
                <h2 className="text-xl">lorem ipsum dolor sit amet, consectetur adipiscing elit.</h2>
                <div className="my-16">
                <StartButton/>
                </div>
            </div>
        </main>
    );
}