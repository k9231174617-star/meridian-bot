import { Link } from "wouter";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex min-h-[100svh] items-center justify-center px-4">
      <Card className="panel-strong w-full max-w-xl rounded-[2rem]">
        <CardContent className="space-y-6 py-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-destructive/20 bg-destructive/10 text-destructive">
            <AlertCircle className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">404</h1>
            <p className="text-lg text-muted-foreground">
              This route does not exist in the current dashboard build.
            </p>
          </div>
          <Button asChild className="rounded-2xl">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Back to overview
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
