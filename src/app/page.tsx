import StartButton from "@/components/StartButton";

export default function Home() {
    return (
        <main>
            <div className="flex flex-col items-center my-50">
                <h1 className="text-5xl font-bold">Welcome to SafeAlert!</h1>
                <h2 className="text-2xl font-medium my-2">Your Home, Secured With Smart Boundaries.</h2>
                <div className="my-16">
                <StartButton/>
                </div>
            </div>
        </main>
    );
}