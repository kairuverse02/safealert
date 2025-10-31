import React from 'react'
import { Spinner } from "@/components/ui/spinner";

const LoadingSpinner = () => {
  return (
    <div className='mx-auto'>
      <Spinner className="size-5" />
    </div>
  )
}

export default LoadingSpinner
