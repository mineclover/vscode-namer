# 유틸 모음

## css에 선언된 클래스들을 복사하거나 d.ts 파일로 만드는 확장

"CSS to Typed: create a css class type"
"CSS to Typed: copy a css class type"

## 생략 없는 타입 추론 결과를 복사할 수 있는 확장

호버 시 복사 버튼이 생성됨
CSS to Typed : "Show inferred type on hover" 옵션을 키면 결과가 호버에도 나옴

타입이 잘 안보인다 싶으면 Prettify 랑 같이 쓰면 좋다

```ts
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};
```

## 개발 시 참고

engines 버전 맞추기 필수
커밋 해야 vsce package patch 이 동작함

npm run compile
vsce package patch
code --install-extension css-to-typed-0.1.14.vsix
